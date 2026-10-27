import ButtonCopy from "@/components/ButtonCopy";

// The host column fits ps1._domainkey on a 375 px phone; values get cut first, and their button copies them whole.
export default function TableDnsRecords({ records }) {
	return (
		<div className="overflow-x-auto rounded-lg shadow-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground">
						<th className="w-16 py-2 pl-3 font-normal">Type</th>
						<th className="w-[46%] py-2 pr-2 font-normal">Host</th>
						<th className="py-2 pr-3 font-normal">Value</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border/60 border-t border-border/60">
					{records.map((record) => (
						<tr key={`${record.type}-${record.name}-${record.value}`}>
							<td className="py-2 pl-3 align-middle font-mono text-xs text-muted-foreground">{record.type}</td>
							<td className="max-w-0 py-2 pr-2 align-middle">
								<div className="flex items-center gap-1">
									<span className="truncate font-mono text-xs">{record.host}</span>
									<ButtonCopy value={record.host} label="Copy host" />
								</div>
							</td>
							<td className="max-w-0 py-2 pr-3 align-middle">
								<div className="flex items-center gap-1">
									<span className="truncate font-mono text-xs">{record.value}</span>
									<ButtonCopy value={record.value} label="Copy value" />
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
