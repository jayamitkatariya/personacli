import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { useStore } from "../state/store";

/** Resolve a relative ref inside a note to a workspace-relative path. */
function resolveRef(ref: string, basePath?: string): string {
  if (ref.startsWith("/")) return ref.slice(1);
  if (!basePath) return ref;
  const folder = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  return folder ? `${folder}/${ref}` : ref;
}

export default function Markdown({ content, basePath }: { content: string; basePath?: string }) {
  const openDoc = useStore((s) => s.openDoc);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        img: (props) => {
          const raw = props.src?.startsWith("http") || props.src?.startsWith("data:")
            ? props.src
            : `/api/fs/raw?path=${encodeURIComponent(resolveRef(props.src ?? "", basePath))}`;
          return (
            <img {...props} src={raw} alt={props.alt ?? ""} />
          );
        },
        a: ({ href, children, ...rest }) => {
          const local =
            !!href &&
            !href.startsWith("http") &&
            !href.startsWith("#") &&
            !href.startsWith("mailto:");
          const resolved = href && local ? resolveRef(href, basePath) : href;
          const resolvedPath = resolved ?? "";
          return (
            <a
              {...rest}
              href={href}
              onClick={
                local
                  ? (e) => {
                      e.preventDefault();
                      if (resolvedPath.endsWith(".md")) void openDoc(resolvedPath);
                      else window.open(`/api/fs/raw?path=${encodeURIComponent(resolvedPath)}`);
                    }
                  : undefined
              }
            >
              {children}
            </a>
          );
        },
        input: (props) => (
          <input
            {...props}
            onChange={(e) => {
              e.preventDefault();
            }}
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
