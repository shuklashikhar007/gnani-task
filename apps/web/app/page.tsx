import GuestId from "@/app/_guest/guest-id";
import RecordingsList from "@/app/_uploads/recordings-list";
import UploadPanel from "@/app/_uploads/upload-panel";

export default function Home() {
    return (
        <div className="flex flex-col flex-1 items-center font-sans">
            <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6 sm:px-16">
                {/* header */}
                <header className="space-y-1">
                    <h1 className="text-2xl font-semibold">Audio Notes</h1>
                    <div className="text-sm text-zinc-500">
                        <GuestId />
                    </div>
                </header>

                {/* uploads */}
                <UploadPanel />
                <RecordingsList />
            </main>
        </div>
    );
}
