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
      Include repo links when mentioning a project.
    `,
  },
  {
    id: "changelog",
    name: "Changelog",
    outputFormat: "markdown",
    instructions: dedent`
      Write a changelog-style report with short bullets and commit highlights.
      Use sections: Added, Changed, Fixed, Docs, DevOps.
      Keep wording minimal and factual.
      Include repo links for each project mentioned.
      When mentioning a specific change, include the commit URL (and file URL when possible).
    `,
  },
  {
    id: "twitter",
    name: "Twitter/X",
    outputFormat: "markdown",
    instructions: dedent`
      Write a single tweet under 280 characters.
      Use a neutral, matter-of-fact tone, but still casual and positive.
      Avoid hype, hashtags, or sign-offs.
      Use emojis when appropriate.
      Include the repo name and 1-2 concrete changes.
      Include repo links.
      Keep it tight and readable.
    `,
  },
];

export function getTemplateById(id: string) {
  return reportTemplates.find((template) => template.id === id);
}
