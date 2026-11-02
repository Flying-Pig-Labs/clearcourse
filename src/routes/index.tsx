import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Richmond Race Lab" },
      { name: "description", content: "Plan Richmond 5K/10K routes and estimate road-closure staffing, time and cost." },
      { property: "og:title", content: "Richmond Race Lab" },
      { property: "og:description", content: "Plan Richmond 5K/10K routes and estimate road-closure staffing, time and cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/race-lab/index.html"
      title="Richmond Race Lab"
      className="fixed inset-0 block h-dvh w-screen border-0"
    />
  );
}
