import {
  createContext,
  useContext,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

const Selection = createContext<{
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  navigate: (tab: string) => void;
} | null>(null);
export function SelectionProvider({
  children,
  navigate,
  selected,
  setSelected,
}: {
  children: ReactNode;
  navigate: (tab: string) => void;
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <Selection.Provider value={{ selected, setSelected, navigate }}>
      {children}
    </Selection.Provider>
  );
}
export function useSelection() {
  const value = useContext(Selection);
  if (!value) throw new Error("Selection provider is required");
  return value;
}
