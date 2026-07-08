import { AppLayout } from "./components/layout/AppLayout";
import { ThemeProvider } from "./components/theme-provider";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="hikaru-theme">
      <AppLayout />
    </ThemeProvider>
  );
}

export default App;
