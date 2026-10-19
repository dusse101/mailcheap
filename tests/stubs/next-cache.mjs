// Paths revalidated, newest last, as [path, type].
export const revalidatedPaths = [];

export function revalidatePath(path, type) {
	revalidatedPaths.push([path, type]);
}

export function revalidateTag() {}

export function unstable_cache(run) {
	return run;
}
