export function toggleMenuPath(currentPath, parentPath, itemId) {
  const targetPath = [...parentPath, itemId];
  const isOpen = currentPath.length >= targetPath.length
    && targetPath.every((id, index) => currentPath[index] === id);
  return isOpen ? parentPath : targetPath;
}
