import RecordingDetail from "@/app/_recording/recording-detail";

export default async function RecordingPage(props: PageProps<"/recordings/[id]">) {
    const { id } = await props.params;
    return (
        <div className="flex flex-col flex-1 items-center font-sans">
            <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6 sm:px-16">
                <RecordingDetail id={id} />
            </main>
        </div>
    );
}
