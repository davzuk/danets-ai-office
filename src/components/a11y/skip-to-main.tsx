/**
 * Skip-to-main-content link. Rendered as the first focusable element in the
 * document body. Hidden visually until focused (via the keyboard) so it
 * doesn't affect the layout, but appears as a high-contrast pill at the
 * top of the viewport the moment a screen reader or keyboard user tabs
 * past it. WCAG 2.4.1 (Bypass Blocks, Level A).
 */
export function SkipToMain() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      Skip to main content
    </a>
  );
}