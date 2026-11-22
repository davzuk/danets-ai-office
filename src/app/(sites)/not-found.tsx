export default function SiteNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-gray-700">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p>This page doesn&apos;t exist or isn&apos;t published.</p>
      <a href="/" className="underline underline-offset-2">
        Go to the home page
      </a>
    </main>
  );
}
