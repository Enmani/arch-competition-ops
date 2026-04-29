const enabledPattern = /^(1|true|yes|on)$/i;

export const defaultOpsReviewActorLabel = "local_operator";

export const isOpsReviewEnabled = () => enabledPattern.test(process.env.ARCH_ENABLE_OPS_REVIEW ?? "");
