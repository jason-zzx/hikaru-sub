export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 计算 object-fit: contain 下媒体在容器内的实际渲染区域。 */
export function computeObjectFitContainRect(
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): DisplayRect {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  if (mediaWidth <= 0 || mediaHeight <= 0) {
    return {
      left: 0,
      top: 0,
      width: containerWidth,
      height: containerHeight,
    };
  }

  const containerAspect = containerWidth / containerHeight;
  const mediaAspect = mediaWidth / mediaHeight;

  let width: number;
  let height: number;

  if (mediaAspect > containerAspect) {
    width = containerWidth;
    height = containerWidth / mediaAspect;
  } else {
    height = containerHeight;
    width = containerHeight * mediaAspect;
  }

  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}
