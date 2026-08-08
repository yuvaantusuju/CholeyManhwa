import { AppShell } from "./components/AppShell";
import { downloadFormats, pageContent } from "./content/static";

export default function HomePage() {
  return <AppShell formats={downloadFormats} content={pageContent} />;
}
