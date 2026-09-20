declare module "typebox" {
  export const Type: {
    Object: (props: Record<string, unknown>) => unknown;
    String: (opts?: Record<string, unknown>) => unknown;
  };
}
