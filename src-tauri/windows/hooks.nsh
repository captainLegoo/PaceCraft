; ========================================================
; PaceCraft Windows NSIS 安装 / 卸载生命周期钩子脚本
; 借助 Tauri 2.0 原生 NSIS Hook 机制实现
; ========================================================

!macro NSIS_HOOK_PREINSTALL
  ; 安装/更新前：终止可能运行中的旧版本进程，防止文件被锁定导致安装报错
  DetailPrint "正在检查并终止可能正在运行的旧版本进程..."
  nsExec::Exec 'taskkill /F /IM PaceCraft.exe /T'
  nsExec::Exec 'taskkill /F /IM server.exe /T'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后钩子（预留）
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载前：关闭正在运行的客户端与后端 sidecar 进程，防止文件被占用残留
  DetailPrint "正在终止可能运行中的 PaceCraft 进程与后台服务..."
  nsExec::Exec 'taskkill /F /IM PaceCraft.exe /T'
  nsExec::Exec 'taskkill /F /IM server.exe /T'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 卸载完成后：询问用户是否同时清理个人跑步数据与配置档案
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除本地跑步数据与配置档案（位于当前用户目录 ~/.coros-dashboard）？$\n$\n【是 (Yes)】：彻底清空所有训练数据库、跑力分析与档案凭据（不可恢复）$\n【否 (No)】：仅卸载软件，保留个人训练历史数据" \
    IDNO skip_delete_user_data

    DetailPrint "正在清理用户个人训练数据与档案..."
    RMDir /r "$PROFILE\.coros-dashboard"

  skip_delete_user_data:
!macroend
