import { useId } from "react";
import "./fenn.css";

export const FENN_STATES = ["idle", "focus", "context-ready", "tests-running", "local-tests-passed", "submission-pending", "accepted", "needs-attention", "reflection-saved", "recall-available", "paused", "offline"] as const;
export type FennState = typeof FENN_STATES[number];
export interface PetRendererProps {
  state: FennState;
  size?: number;
  reducedMotion?: boolean;
  hidden?: boolean;
  className?: string;
}

/** Original, editable SVG rig. Anchors share one 180 × 180 coordinate system. */
export function Fenn({ state, size = 112, reducedMotion = false, hidden = false, className = "" }: PetRendererProps) {
  const id = useId().replace(/:/g, "");
  const resting = state === "paused";
  return <svg className={`fenn fenn--${state} ${reducedMotion ? "fenn--still" : ""} ${hidden ? "fenn--hidden" : ""} ${className}`} width={size} height={size} viewBox="0 0 180 180" fill="none" aria-hidden="true" data-pet-state={state}>
    <defs>
      <linearGradient id={`${id}-coat`} x1="71" y1="35" x2="130" y2="151" gradientUnits="userSpaceOnUse"><stop stopColor="#FFF9EB"/><stop offset=".64" stopColor="#F2EBDD"/><stop offset="1" stopColor="#D8CCB7"/></linearGradient>
      <linearGradient id={`${id}-tail`} x1="15" y1="105" x2="81" y2="151" gradientUnits="userSpaceOnUse"><stop stopColor="#E9DDC7"/><stop offset="1" stopColor="#D3C2A4"/></linearGradient>
      <linearGradient id={`${id}-face`} x1="84" y1="61" x2="107" y2="105" gradientUnits="userSpaceOnUse"><stop stopColor="#FFFCF3"/><stop offset="1" stopColor="#F4ECDB"/></linearGradient>
      <linearGradient id={`${id}-scarf`} x1="84" y1="102" x2="116" y2="129" gradientUnits="userSpaceOnUse"><stop stopColor="#A1B19A"/><stop offset="1" stopColor="#71886F"/></linearGradient>
      <radialGradient id={`${id}-shadow`}><stop stopColor="#292C27" stopOpacity=".16"/><stop offset="1" stopColor="#292C27" stopOpacity="0"/></radialGradient>
    </defs>
    <g data-layer="shadow"><ellipse cx="91" cy="157" rx="66" ry="10" fill={`url(#${id}-shadow)`}/></g>
    <g className="fenn-tail" data-layer="tail">
      <path d="M82 147C61 162 20 153 17 128C14 109 28 91 50 88C43 98 44 112 54 119C64 126 76 122 84 131C88 136 88 143 82 147Z" fill={`url(#${id}-tail)`} stroke="#B7A88E" strokeWidth=".8"/>
      <path d="M50 88C32 90 20 101 17 116C27 124 41 123 48 116C42 108 43 97 50 88Z" fill="#FBF5E7"/>
      <path d="M29 136C39 147 63 150 78 140" stroke="#C3B296" strokeWidth="1.1" strokeLinecap="round" opacity=".55"/>
    </g>
    <g className="fenn-body" data-layer="body">
      <path d="M70 96C61 110 58 132 65 146C72 158 112 160 126 148C138 136 130 109 118 97Z" fill={`url(#${id}-coat)`} stroke="#C9BEA9" strokeWidth=".8"/>
      <path d="M94 107C80 111 76 129 80 144C85 150 108 152 116 144C120 130 113 111 104 107Z" fill="#FBF6E9" opacity=".9"/>
      <path d="M72 116C67 126 67 139 72 144M121 115C127 127 127 138 123 144" stroke="#D7CAB5" strokeWidth="1.2" strokeLinecap="round"/>
    </g>
    <g className="fenn-head" data-layer="head">
      <g data-layer="ears">
        <path d="M64 69C57 55 55 32 60 25C72 28 83 43 86 56Z" fill={`url(#${id}-coat)`} stroke="#C5B89E" strokeWidth=".8"/>
        <path d="M65 57C61 45 61 36 62 33C69 37 75 44 78 52Z" fill="#BDA58A"/><path d="M64 49C63 43 63 39 64 37L71 46Z" fill="#CDB99E"/>
        <path d="M109 55C114 42 127 28 139 27C143 39 136 59 128 70Z" fill={`url(#${id}-coat)`} stroke="#C5B89E" strokeWidth=".8"/>
        <path d="M118 53C122 45 129 38 135 35C135 43 132 51 127 58Z" fill="#BDA58A"/>
      </g>
      <path d="M62 64C70 49 84 47 96 49C112 47 128 56 134 72L140 83L130 91C125 104 109 111 96 112C81 112 68 103 62 92L53 83Z" fill={`url(#${id}-coat)`} stroke="#C9BEA9" strokeWidth=".8"/>
      <path d="M57 82C64 75 76 77 88 86L96 92L104 85C116 76 130 76 138 83L130 92C122 104 108 109 96 109C81 108 67 101 62 91Z" fill={`url(#${id}-face)`}/>
      <path d="M91 64L95 60L99 64" stroke="#D7CCB7" strokeWidth="1.1" strokeLinecap="round"/>
      <g className="fenn-eyes" data-layer="eyes">
        {resting ? <><path d="M75 83C78 86 81 86 84 83M108 83C111 86 114 86 117 83" stroke="#37372E" strokeWidth="2.2" strokeLinecap="round"/></> : <><ellipse cx="79.5" cy="82" rx="3.2" ry="4.1" fill="#292C27"/><ellipse cx="112" cy="82" rx="3.2" ry="4.1" fill="#292C27"/><circle cx="80.2" cy="80.7" r=".8" fill="#FFFCF5"/><circle cx="112.7" cy="80.7" r=".8" fill="#FFFCF5"/></>}
      </g>
      <path d="M92 92C92 90 100 90 100 92C100 94 97 96 96 96C95 96 92 94 92 92Z" fill="#34372F"/>
      <path d="M96 96V98M92 99C94 100 96 98 96 98C96 98 98 100 100 99" stroke="#716B5B" strokeWidth=".9" strokeLinecap="round"/>
      <ellipse cx="70" cy="90" rx="5.5" ry="2" fill="#D9BDA0" opacity=".28"/><ellipse cx="121" cy="90" rx="5.5" ry="2" fill="#D9BDA0" opacity=".28"/>
    </g>
    <g data-layer="scarf" className="fenn-scarf">
      <path d="M74 103C86 111 108 111 121 102L123 112C110 121 86 120 73 112Z" fill={`url(#${id}-scarf)`} stroke="#748A71" strokeWidth=".6"/>
      <path d="M109 114L124 111L130 137C126 141 119 142 114 139Z" fill={`url(#${id}-scarf)`}/>
      <path d="M116 133L127 131M117 136L128 134" stroke="#C6D0BB" strokeWidth="1" opacity=".6"/>
      <path d="M77 107C91 114 107 114 119 106" stroke="#C0CCB4" strokeWidth="1.3" strokeLinecap="round" opacity=".7"/>
    </g>
    <g data-layer="paws"><path d="M77 140C68 140 65 145 68 150C72 154 84 155 89 151L90 144Z" fill="#F8F1E2" stroke="#C9BEA9" strokeWidth=".8"/><path d="M107 142L106 151C112 155 124 154 127 150C130 145 122 140 116 140Z" fill="#F8F1E2" stroke="#C9BEA9" strokeWidth=".8"/><path d="M74 148V151M79 149V152M115 149V152M120 148V151" stroke="#CABDA6" strokeWidth=".8" strokeLinecap="round"/></g>
    {(state === "accepted" || state === "reflection-saved") && <g className="fenn-spark" data-layer="accessory"><path d="M148 55L150 61L156 63L150 65L148 71L146 65L140 63L146 61Z" fill="#C3A56C"/><path d="M39 60L40 63L43 64L40 65L39 68L38 65L35 64L38 63Z" fill="#C3A56C" opacity=".7"/></g>}
    {state === "recall-available" && <g data-layer="accessory"><path d="M141 82H153V102L147 98L141 102Z" fill="#8B9F8A" stroke="#FAF8F3" strokeWidth="2"/><path d="M145 88H149M145 91H149" stroke="#E5EADF" strokeLinecap="round"/></g>}
    {state === "needs-attention" && <g data-layer="accessory"><circle cx="147" cy="91" r="8" fill="#C3A56C" stroke="#FAF8F3" strokeWidth="2"/><path d="M147 87V91M147 94H147.01" stroke="#393B2F" strokeWidth="1.5" strokeLinecap="round"/></g>}
  </svg>;
}
