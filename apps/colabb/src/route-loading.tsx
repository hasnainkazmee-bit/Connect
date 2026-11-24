import { Component, type ReactNode } from "react";

// A stale open tab or interrupted chunk download must not remove navigation.
// Recovery is explicit so an automatic refresh cannot discard somebody's work.
export class RouteLoadBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty" role="alert">
        <h2>This page couldn’t open.</h2>
        <p>
          The connection may have interrupted, or Colabb may have been updated.
        </p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Refresh to try again
        </button>
      </section>
    );
  }
}
