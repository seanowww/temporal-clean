import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Temporal — Context Operations",
  description: "Evidence-backed timelines for pull request review.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/*
          THESIS: Temporal makes company memory spatial: choosing a pull request reveals the exact constellation of work that shaped it.
          OWN-WORLD: An Obsidian-like provenance field framed by two collapsible instrument rails, source-native marks, and evidence-colored paths.
          STORY: Connections live quietly at left; the graph owns the canvas; PR history at right turns the relevant evidence path on and exposes the artifact action.
          FIRST VIEWPORT: A full-height luminous knowledge graph, compact connection dock, collapsible PR index, and one selection action floating above the field.
          FORM: Code-led operating surface extending the incumbent Temporal constellation; interaction is selection light moving through the graph.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
        */}
        {children}
      </body>
    </html>
  );
}
