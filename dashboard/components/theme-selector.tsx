"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useThemeWithFallback } from "@/components/theme-provider";
import { Moon, Sun, Monitor } from "lucide-react";
import { useEffect, useState } from "react";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeSelector() {
  const { theme, setTheme } = useThemeWithFallback();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render until client-side hydration is complete
  if (!mounted) {
    return <div className="h-10 w-32 opacity-50 rounded-lg bg-muted" />;
  }

  const selectedOption = themeOptions.find((opt) => opt.value === theme);
  const SelectedIcon = selectedOption?.icon || Sun;

  return (
    <div className="space-y-3">
      <Label htmlFor="theme-select">Theme</Label>
      <Select value={theme} onValueChange={(value) => setTheme(value as any)}>
        <SelectTrigger id="theme-select" className="w-32">
          <SelectValue placeholder="Select theme" />
        </SelectTrigger>
        <SelectContent>
          {themeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span>{option.label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
