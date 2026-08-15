// Stub for next/navigation: its client hooks throw "invariant expected app router to be
// mounted" when rendered outside a Next request. Match the resolved module path broadly so
// both the built (`next/navigation.js`) and source (`next/.../navigation.ts`) forms are caught.
function isNav(url) {
  return url.includes("node_modules/next") && url.toLowerCase().includes("navigation");
}
export async function load(url, context, next) {
  if (isNav(url)) {
    return {
      format: "module",
      shortCircuit: true,
      source:
        "export function useRouter(){return {refresh(){},push(){},replace(){},prefetch(){}};}" +
        "export function usePathname(){return '/';}" +
        "export function useSearchParams(){return new URLSearchParams();}" +
        "export function useParams(){return {};}" +
        "export function notFound(){throw new Error('NEXT_NOT_FOUND');}" +
        "export function redirect(){throw new Error('NEXT_REDIRECT');}",
    };
  }
  return next(url, context);
}
