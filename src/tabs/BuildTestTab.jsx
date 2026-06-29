import { ComingSoon } from "../components/primitives";

export default function BuildTestTab(){
  return (
    <ComingSoon
      title="Build & Test"
      description="Experiment with the strategy parameters and see how the portfolio composition would change."
      items={[
        "Adjust all 5 screening filters with live sliders",
        "Sector inclusion / exclusion toggle",
        "See funnel change in real time",
        "Compare your custom screen vs the base strategy",
        "What-if scenarios â€” P/E at 25x, Beta at 1.5x",
      ]}
    />
  );
}
