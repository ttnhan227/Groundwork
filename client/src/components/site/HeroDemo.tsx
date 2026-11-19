import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const HERO_DEMO_ALT =
  "Groundwork in action — Native Windows Storage Analyzer, Storage Sense Cleaner, and Hardware Diagnostics";

function getInitialReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Renders the hero product demo using WebM/MP4 video with a WebP poster,
 * a visible keyboard-accessible Pause/Play toggle, and a static image default
 * when `prefers-reduced-motion: reduce` is active.
 */
export function HeroDemo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    getInitialReducedMotion,
  );
  const [userStartedVideo, setUserStartedVideo] = useState(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(
    () => !getInitialReducedMotion(),
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = (matches: boolean) => {
      setPrefersReducedMotion(matches);
      if (matches) {
        videoRef.current?.pause();
        setIsPlaying(false);
        setUserStartedVideo(false);
      } else {
        setIsPlaying(true);
      }
    };

    syncPreference(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncPreference(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const showStaticPoster = prefersReducedMotion && !userStartedVideo;

  useEffect(() => {
    if (showStaticPoster) return;
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    if (isPlaying && video.paused) {
      video.play()?.catch(() => {
        setIsPlaying(false);
      });
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [showStaticPoster, isPlaying]);

  const handleTogglePlayback = () => {
    if (showStaticPoster) {
      setUserStartedVideo(true);
      setIsPlaying(true);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (video.paused || !isPlaying) {
      setIsPlaying(true);
      video.play()?.catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <figure className="product-workspace-shot">
      <div className="product-workspace-frame">
        {showStaticPoster ? (
          <img
            src="/groundwork-in-action-poster.webp"
            alt={HERO_DEMO_ALT}
            width={1000}
            height={622}
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <video
            ref={videoRef}
            poster="/groundwork-in-action-poster.webp"
            width={1000}
            height={622}
            autoPlay={!prefersReducedMotion || userStartedVideo}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={HERO_DEMO_ALT}
            aria-describedby="hero-demo-caption"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          >
            <source src="/groundwork-in-action.webm" type="video/webm" />
            <source src="/groundwork-in-action.mp4" type="video/mp4" />
          </video>
        )}
      </div>
      <div className="product-workspace-meta">
        <button
          type="button"
          className="product-demo-toggle"
          onClick={handleTogglePlayback}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          <span>{isPlaying ? "Pause demo" : "Play demo"}</span>
        </button>
        <figcaption id="hero-demo-caption">
          Groundwork in action: live proportional storage maps, Storage Sense
          recommendations, application leftovers, and instant hardware
          diagnostics.
        </figcaption>
      </div>
    </figure>
  );
}
