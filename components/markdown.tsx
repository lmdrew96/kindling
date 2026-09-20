'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * The one markdown surface in Kindling. Sparks are written by Claude as often
 * as by hand, so they arrive full of headings, bullets, tables and bold — all
 * of which used to render as literal asterisks inside a single collapsed
 * paragraph.
 *
 * Security: react-markdown escapes raw HTML by default. `rehype-raw` is the
 * only thing that would change that, and it is deliberately not used here, so
 * no separate sanitization pass is needed. Do not add it.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-fg break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="font-display text-base font-bold text-fg mt-3 first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="font-display text-sm font-bold text-fg mt-3 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="font-display text-sm font-semibold text-fg mt-3 first:mt-0">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="text-sm font-semibold text-fg-muted mt-2 first:mt-0">{children}</h5>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-tag-bg px-1 py-0.5 text-[0.85em] text-tag-fg">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-tag-bg p-3 text-xs text-tag-fg">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border-strong pl-3 text-fg-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
