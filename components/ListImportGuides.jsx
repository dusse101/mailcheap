import IconBrand from "@/components/IconBrand";
import { Button } from "@/components/ui/button";

// Under the import dialog's drop zone: how to export the file from each platform (siteExtensions.importGuides), in a new
// tab so the dialog stays open.
export default function ListImportGuides({ guides }) {
	if (guides.length === 0) return null;
	return (
		<div className="flex flex-col items-center gap-2">
			<p className="text-xs text-muted-foreground">How to export your list</p>
			<ul className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-center">
				{guides.map(({ brand, name, href }) => (
					<li key={brand}>
						<Button asChild variant="outline" size="sm" className="w-full pl-1.5 sm:w-auto">
							<a href={href} target="_blank" rel="noopener">
								<IconBrand brand={brand} className="size-4" />
								{name}
							</a>
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
