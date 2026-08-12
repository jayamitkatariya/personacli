import Markdown from "./Markdown";

export default function MarkdownPreview({ content, path }: { content: string; path?: string }) {
  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-stone-800">
      <div className="max-w-[720px] mx-auto px-8 py-8 md-body">
        <Markdown content={content} basePath={path} />
      </div>
    </div>
  );
}
