import { PasswordGate } from "@/components/auth/password-gate";
import { Aurora } from "@/components/ui/aurora";

export default function LoginPage() {
  return (
    <div className="relative min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <Aurora
        colorStops={["#3b82f6", "#8b5cf6", "#ec4899"]}
        speed={0.4}
        amplitude={0.5}
      />
      <div className="relative z-10">
        <PasswordGate />
      </div>
    </div>
  );
}
