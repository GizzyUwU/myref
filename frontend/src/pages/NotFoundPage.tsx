import { A } from "@solidjs/router";

export function NotFoundPage() {
  return (
    <div class="notfound">
      <div>
        <h1>404</h1>
        <p class="subtle">That page does not exist.</p>
        <A href="/" class="btn btn-primary">
          Go home
        </A>
      </div>
    </div>
  );
}
