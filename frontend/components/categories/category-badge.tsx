interface CategoryBadgeProps {
  name: string;
  color: string;
}

export function CategoryBadge({ name, color }: CategoryBadgeProps) {
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}33`,
      }}
    >
      {name}
    </span>
  );
}
