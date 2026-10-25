import { createContext, useContext, type ReactNode, type AnchorHTMLAttributes } from "react";
export const Navigation = createContext({ pathname: "/refine", navigate: (_path: string) => {} });
export function usePathname() {
  return useContext(Navigation).pathname;
}
export function useRouter() {
  const { navigate } = useContext(Navigation);
  return { push: navigate, replace: navigate, refresh: () => {} };
}
export default function Link({
  href,
  children,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  const { navigate } = useContext(Navigation);
  return (
    <a
      {...rest}
      href={`#${href}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
