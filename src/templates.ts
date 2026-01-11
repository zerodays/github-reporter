import dedent from "dedent";

export type ReportTemplate = {
  id: string;
  name: string;
  outputFormat?: "markdown" | "json";
  instructions: string;
};

export const reportTemplates: ReportTemplate[] = [
  {
    id: "dev-diary",
    name: "Dev Diary",
    outputFormat: "markdown",
    instructions: dedent`
      Write a very short dev diary entry (2-4 short paragraphs).
      Tone: personal, casual, easy to read quickly.
      Avoid hype and heavy emotion.
      Mention concrete changes and focus on what was done and why it matters.
    `
  },
  {
    id: "changelog",
    name: "Changelog",
    outputFormat: "markdown",
    instructions: dedent`
      Write a changelog-style report with short bullets and commit highlights.
      Use sections: Added, Changed, Fixed, Docs, DevOps.
      Keep wording minimal and factual.
    `
  },
  {
    id: "twitter",
    name: "Twitter/X",
    outputFormat: "markdown",
    instructions: dedent`
      Write a single tweet under 280 characters.
      Include the repo name and 1-2 concrete changes.
      Keep it punchy and factual.
    `
  }
];

export function getTemplateById(id: string) {
  return reportTemplates.find((template) => template.id === id);
}
