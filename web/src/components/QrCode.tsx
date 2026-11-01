import React, { useMemo } from "react";
import { qrcodegen } from "../utils/qrcodegen";

interface QrCodeProps {
  text: string;
  size?: number;
  className?: string;
  border?: number;
  fgColor?: string;
  bgColor?: string;
}

export default function QrCode({
  text,
  size = 180,
  className = "",
  border = 2,
  fgColor = "#111827",
  bgColor = "#ffffff",
}: QrCodeProps) {
  const qr = useMemo(() => {
    try {
      if (!text) return null;
      return qrcodegen.QrCode.encodeText(text, qrcodegen.Ecc.MEDIUM);
    } catch (e) {
      console.error("[QrCode] 生成二维码异常:", e);
      return null;
    }
  }, [text]);

  if (!qr) return null;

  const qrSize = qr.size;
  const viewBoxSize = qrSize + border * 2;

  // Generate SVG path for all dark modules
  let path = "";
  for (let y = 0; y < qrSize; y++) {
    for (let x = 0; x < qrSize; x++) {
      if (qr.getModule(x, y)) {
        path += `M${x + border},${y + border}h1v1h-1z `;
      }
    }
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      className={className}
      style={{ shapeRendering: "crispEdges", borderRadius: 8, display: "block" }}
    >
      <rect width="100%" height="100%" fill={bgColor} rx={4} />
      <path d={path} fill={fgColor} />
    </svg>
  );
}
