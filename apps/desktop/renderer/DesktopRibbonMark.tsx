import type { RefObject } from "react";
import { RibbonMark } from "../../../packages/ribbon/RibbonMark";
import "./desktop-ribbon-mark.css";

export type RibbonFeedback = { kind: "thought" | "bookmark"; id: number };

export function DesktopRibbonMark({
  size = 34,
  focusing,
  tucked,
  recording,
  meterRef,
  feedback,
}: {
  size?: number;
  focusing?: boolean;
  tucked?: "left" | "right";
  recording?: boolean;
  meterRef?: RefObject<HTMLSpanElement | null>;
  feedback?: RibbonFeedback | null;
}) {
  return (
    <span className="desktop-ribbon-mark" data-focus={focusing} data-edge={tucked} aria-hidden="true">
      <span className="desktop-ribbon-pose">
        <span className="desktop-ribbon-fold" key={feedback?.id} data-feedback={feedback?.kind}>
          <RibbonMark size={size}/>
        </span>
      </span>
      {recording && <span className="desktop-ribbon-seam" ref={meterRef}/>}
    </span>
  );
}
