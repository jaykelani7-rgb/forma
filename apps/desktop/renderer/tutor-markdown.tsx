import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { tutorExternalUrl } from './tutor-rendering-policy';

/** No raw HTML plugin, image fetches, model-defined components, or renderer navigation. */
export function TutorMarkdown({text,turnId,onOpenLink}:{text:string;turnId:string;onOpenLink:(url:string)=>void}) {
  return <div className="tutor-answer" data-tutor-turn-id={turnId}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm,remarkMath]}
      rehypePlugins={[[rehypeKatex,{trust:false,strict:'ignore',throwOnError:false,maxExpand:1000}]]}
      urlTransform={value=>tutorExternalUrl(value)??''}
      components={{
        a:({href,children})=>{const url=href?tutorExternalUrl(href):null;return url?<button type="button" className="tutor-markdown-link" onClick={()=>onOpenLink(url)} title={`Open ${new URL(url).hostname} in your browser`}>{children}<span className="tutor-link-destination"> ↗ {new URL(url).hostname}</span></button>:<span>{children}</span>;},
        img:({alt})=><span className="tutor-image-label">{alt?`[Image: ${alt}]`:'[Image omitted]'}</span>,
      }}
    >{text}</ReactMarkdown>
  </div>;
}
