import React, { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  applyMode,
  applyDensity,
  Mode,
  Density,
} from "@cloudscape-design/global-styles";

interface PreferencesContextType {
  darkMode: boolean;
  setDarkMode: (enabled: boolean) => void;
  density: Density;
  setDensity: (density: Density) => void;
  demoMode: boolean;
  setDemoMode: (enabled: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

const STORAGE_KEY = "app-preferences";

function loadPreferences(): { darkMode: boolean; density: Density; demoMode: boolean } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        darkMode: parsed.darkMode ?? false,
        density: parsed.density === Density.Compact ? Density.Compact : Density.Comfortable,
        demoMode: parsed.demoMode ?? false,
      };
    }
  } catch {
    // ignore
  }
  return { darkMode: false, density: Density.Comfortable, demoMode: false };
}

export const PreferencesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initial = loadPreferences();
  const [darkMode, setDarkModeState] = useState(initial.darkMode);
  const [density, setDensityState] = useState<Density>(initial.density);
  const [demoMode, setDemoModeState] = useState(initial.demoMode);

  useEffect(() => {
    applyMode(darkMode ? Mode.Dark : Mode.Light);
  }, [darkMode]);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ darkMode, density, demoMode }));
  }, [darkMode, density, demoMode]);

  const setDarkMode = (enabled: boolean) => setDarkModeState(enabled);
  const setDensity = (d: Density) => setDensityState(d);
  const setDemoMode = (enabled: boolean) => setDemoModeState(enabled);

  return (
    <PreferencesContext.Provider value={{ darkMode, setDarkMode, density, setDensity, demoMode, setDemoMode }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesContextType => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
};
