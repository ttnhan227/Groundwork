import { useEffect, useState } from "react";
export function LoadingState({title, detail, skeleton = false, elapsed = false}: {title: string; detail?: string; skeleton?: boolean; elapsed?: boolean}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {if(!elapsed) return; const started = Date.now(); const timer=setInterval(() => setSeconds(Math.floor((Date.now()-started)/1000)),1000); return () => clearInterval(timer);}, [elapsed]);
  return <div className="gw-loading-state" role="status" aria-live="polite">
    <div className="gw-loading-heading"><span className="gw-loading-spinner" aria-hidden="true"/><div><strong>{title}</strong>{detail && <p>{detail}</p>}</div></div>
    {skeleton && <div className="gw-loading-skeleton" aria-hidden="true"><i/><i/><i/><i/></div>}
    {elapsed && seconds >= 5 && <p className="gw-loading-elapsed" aria-live="off">Working for {seconds}s</p>}
  </div>;
}
