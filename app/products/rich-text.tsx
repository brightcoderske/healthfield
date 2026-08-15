import { richTextToSafeHtml } from "@/lib/rich-text-content";

/**
 * Renders both Tiptap HTML and the legacy token format. All author content is
 * sanitized at this final display boundary before it reaches the page.
 */
export function RichText({ value }: { value: string }) {
  return <div className="rich-content" dangerouslySetInnerHTML={{ __html: richTextToSafeHtml(value) }} />;
}
