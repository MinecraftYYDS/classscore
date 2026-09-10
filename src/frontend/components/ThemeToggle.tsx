import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "light" ? "切换到夜间模式" : "切换到白天模式"}
      className="cs-btn border border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-300"
    >
      {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
