type FirstTimeCaptionProps = {
  caption: string | null;
};

export function FirstTimeCaption({ caption }: FirstTimeCaptionProps) {
  if (!caption) return null;
  return <div className="caption">{caption}</div>;
}
