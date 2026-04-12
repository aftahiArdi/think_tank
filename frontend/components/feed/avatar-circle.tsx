"use client";

function usernameColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = Math.imul(31, hash) + username.charCodeAt(i) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

interface AvatarCircleProps {
  username: string;
  avatarUrl?: string | null;
  size?: number;
}

export function AvatarCircle({ username, avatarUrl, size = 40 }: AvatarCircleProps) {
  const initials = username.slice(0, 2).toUpperCase();
  const bg = usernameColor(username);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.35,
        fontWeight: 700,
        color: "#fff",
        letterSpacing: "-0.02em",
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={username}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}
