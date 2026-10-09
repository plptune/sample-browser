import { render } from "solid-js/web";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/bundle.css";
import "./demo/demo.css";

render(() => <App />, document.getElementById("root")!);
