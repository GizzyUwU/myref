import type { JSX } from "solid-js";
import { Logo } from "./Brand";

export function AuthLayout(props: {
  title: string;
  subtitle: string;
  children: JSX.Element;
}) {
  return (
    <div class="auth-shell">
      <aside class="auth-brand">
        <Logo />

        <div class="auth-brand-copy">
          <p class="eyebrow">Referencing, sorted</p>
          <h2>
            Build your bibliography
            <br />
            without the paywall.
          </h2>
          <p class="auth-brand-sub">
            Works with thousands of CSL citation styles, so your references
            match whatever your tutors expect.
          </p>

          <div class="sample-card">
            <div class="sample-card-head">
              <span class="style-chip light">Harvard style</span>
              <span class="sample-label">Reference preview</span>
            </div>
            <p>
              Pears, R., Shields, G. (2019) <em>Cite them right: the essential
              referencing guide</em>. 11th edn. London: Red Globe Press.
            </p>
            <p class="sample-cite">(Pears and Shields, 2019)</p>
          </div>
        </div>

        <p class="auth-brand-foot">
          Free, self-hosted, and your data stays on your machine.
        </p>
      </aside>

      <main class="auth-main">
        <div class="auth-card">
          <h1>{props.title}</h1>
          <p class="auth-subtitle">{props.subtitle}</p>
          {props.children}
        </div>
      </main>
    </div>
  );
}
