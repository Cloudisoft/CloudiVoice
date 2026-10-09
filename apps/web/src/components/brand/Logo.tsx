import Image from "next/image";
import Link from "next/link";

/** CloudiVoice wordmark with the official Cloudisoft cloud mark. */
export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="logo" aria-label="CloudiVoice home">
      <Image src="/brand/cloudisoft-mark.png" alt="" width={34} height={34} priority className="logo-mark" />
      {!compact && (
        <span className="logo-text">
          <span className="logo-name">
            Cloudi<span className="gradient-text">Voice</span>
          </span>
          <span className="logo-by mono">by Cloudisoft</span>
        </span>
      )}
    </Link>
  );
}
