import { useEffect, useRef, useState } from "react";
import { api, type ProfileItem } from "../api";

export default function ProfileSwitcher({
  onProfileChanged,
  onRequireAuth,
}: {
  onProfileChanged: () => void;
  onRequireAuth?: () => void;
}) {
  const [data, setData] = useState<{ activeId: string; profiles: ProfileItem[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadProfiles = async () => {
    try {
      const res = await api.profiles();
      setData(res);
      return res;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  // 点击外部收起
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setEditingId(null);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const activeProfile = data?.profiles.find((p) => p.id === data.activeId);

  const handleSwitch = async (id: string) => {
    if (id === data?.activeId) {
      setOpen(false);
      return;
    }
    try {
      await api.switchProfile(id);
      setOpen(false);
      await loadProfiles();
      onProfileChanged();
    } catch (e) {
      alert(`切换失败: ${(e as Error).message}`);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createProfile(name);
      setNewName("");
      setCreating(false);
      setOpen(false);
      await loadProfiles();
      onProfileChanged();
      onRequireAuth?.();
    } catch (e) {
      alert(`创建失败: ${(e as Error).message}`);
    }
  };

  const handleSaveName = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await api.updateProfile(id, name);
      setEditingId(null);
      await loadProfiles();
      onProfileChanged();
    } catch (e) {
      alert(`更新失败: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!window.confirm(`确定要删除跑友档案「${name}」吗？\n该档案下的所有本地训练数据和凭证将被彻底删除且无法恢复。`)) {
      return;
    }
    try {
      await api.deleteProfile(id);
      await loadProfiles();
      onProfileChanged();
    } catch (e) {
      alert(`删除失败: ${(e as Error).message}`);
    }
  };

  const displayName = activeProfile?.nickname || activeProfile?.name || "默认跑友";
  const avatarLetter = (activeProfile?.nickname || activeProfile?.name || "P").slice(0, 1).toUpperCase();

  return (
    <div className="profile-switcher-container" ref={dropdownRef} style={{ position: "relative", marginBottom: 12 }}>
      {/* 侧边栏常驻触发卡片 */}
      <button
        type="button"
        className="profile-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        title="点击切换跑友档案"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #2563eb 0%, #10b981 100%)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
            }}
          >
            {avatarLetter}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
              <span>跑友档案</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ color: "var(--accent)" }}>切换 ▾</span>
            </div>
          </div>
        </div>
      </button>

      {/* 下拉浮层 */}
      {open && (
        <div className="profile-dropdown-panel">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              padding: "4px 8px 8px 8px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>跑友档案库（独立隔离）</span>
            <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{data?.profiles.length} 个账号</span>
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", margin: "6px 0", display: "flex", flexDirection: "column", gap: 3 }}>
            {data?.profiles.map((p) => {
              const isActive = p.id === data.activeId;
              const isEditing = editingId === p.id;
              const nameText = p.nickname || p.name;
              const initial = nameText.slice(0, 1).toUpperCase();

              return (
                <div
                  key={p.id}
                  className={`profile-item-row ${isActive ? "active" : ""}`}
                  onClick={() => !isEditing && handleSwitch(p.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: isActive ? "#2563eb" : "var(--surface-3)",
                        color: isActive ? "#ffffff" : "var(--text)",
                        border: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {initial}
                    </div>

                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveName(p.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        style={{
                          fontSize: 12,
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          border: "1px solid var(--accent)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          width: "100%",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <div style={{ minWidth: 0 }}>
                        <div className="profile-name-text">
                          <span>{nameText}</span>
                          {isActive && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                color: "var(--good)",
                                background: "var(--good-bg)",
                                border: "1px solid var(--good-border)",
                                padding: "1px 5px",
                                borderRadius: 4,
                              }}
                            >
                              当前
                            </span>
                          )}
                        </div>
                        {p.nickname && p.name !== p.nickname && (
                          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>备注: {p.name}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作小图标 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => handleSaveName(p.id)}
                        style={{
                          border: "none",
                          background: "#2563eb",
                          color: "#fff",
                          borderRadius: 4,
                          fontSize: 10.5,
                          padding: "2px 6px",
                          cursor: "pointer",
                        }}
                      >
                        保存
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditName(p.name);
                          }}
                          title="修改备注"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--text-dim)",
                            cursor: "pointer",
                            fontSize: 11,
                            padding: "2px 4px",
                          }}
                        >
                          ✎
                        </button>
                        {data.profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, p.id, nameText)}
                            title="删除该档案"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "var(--text-dim)",
                              cursor: "pointer",
                              fontSize: 13,
                              padding: "2px 4px",
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 新增跑友入口 */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
            {creating ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  placeholder="跑友称呼，如：老张"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                  style={{
                    flex: 1,
                    fontSize: 12,
                    background: "var(--input-bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "5px 8px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  style={{
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "0 10px",
                    cursor: "pointer",
                  }}
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  style={{
                    background: "transparent",
                    color: "var(--text-dim)",
                    border: "none",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "7px 0",
                  background: "var(--surface-2)",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: 6,
                  color: "var(--accent)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
              >
                <span>➕</span>
                <span>添加新跑友档案</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
