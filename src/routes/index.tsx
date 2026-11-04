import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClearCourse — Race routes. Less disruption." },
      { name: "description", content: "Plan Richmond 5K/10K routes and estimate road-closure staffing, time and cost." },
      { property: "og:title", content: "ClearCourse — Race routes. Less disruption." },
      { property: "og:description", content: "Plan Richmond 5K/10K routes and estimate road-closure staffing, time and cost." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://race-lab.lovable.app/" },
      { property: "og:image", content: "https://race-lab.lovable.app/clearcourse-share.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://race-lab.lovable.app/clearcourse-share.png" },
    ],
    links: [{ rel: "canonical", href: "https://race-lab.lovable.app/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/race-lab/index.html"
      title="ClearCourse"
      className="fixed inset-0 block h-dvh w-screen border-0"
    />
  );
}
