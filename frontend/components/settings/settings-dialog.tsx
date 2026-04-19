"use client";

import type { RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { BiometricToggle } from "@/components/auth/biometric-toggle";
import { LocationToggle } from "@/components/location/location-toggle";
import { AvatarCircle } from "@/components/feed/avatar-circle";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  avatarUrl: string | null;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SettingsDialog({ open, onOpenChange, username, avatarUrl, avatarInputRef, onAvatarChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--foreground)" }}>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-1">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="relative active:opacity-70 transition-opacity"
            >
              <AvatarCircle username={username} avatarUrl={avatarUrl} size={72} />
              <div
                className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
              >
                <span className="text-white text-xs font-medium">Edit</span>
              </div>
            </button>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{username}</p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Tap to change photo</p>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarChange}
            />
          </div>

          <BiometricToggle />

          <LocationToggle />

          <div>
            <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
              Theme
            </p>
            <ThemeSelector />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
