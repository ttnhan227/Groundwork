export function Footer({ navigate }: { navigate: (path: string) => void }) {
  return (
    <footer className="product-footer">
      Groundwork is open-source software under the{" "}
      <a href="https://github.com/ttnhan227/Groundwork/blob/main/LICENSE">
        MIT license
      </a>
      .<span> · </span>
      <button onClick={() => navigate("/privacy")}>Privacy</button>
      <span> · </span>
      <button onClick={() => navigate("/contact")}>Contact</button>
    </footer>
  );
}
