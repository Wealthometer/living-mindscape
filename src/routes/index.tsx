import { createFileRoute } from "@tanstack/react-router";
import { NeuralNetwork } from "@/components/NeuralNetwork";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Living Neural Network — Grow your mind" },
      { name: "description", content: "Capture ideas as neurons. Link them to strengthen connections. Watch your knowledge grow into a living network." },
    ],
  }),
  component: Index,
});

function Index() {
  return <NeuralNetwork />;
}
