
const steps = [
  {
    title: "Next.js Frontend",
    description: "User selects and uploads an audio file",
    color: "#2563eb",
    background: "#eff6ff",
    label: "HTTP Upload",
  },
  {
    title: "FastAPI Backend",
    description: "Receives request and validates audio",
    color: "#7c3aed",
    background: "#f5f3ff",
    label: "Validated Audio",
  },
  {
    title: "Cloudflare R2",
    description: "Stores audio file and retains object reference",
    color: "#0d9488",
    background: "#f0fdfa",
    label: "Audio / URI",
  },
  {
    title: "Gnani API",
    description: "Processes audio and returns transcript",
    color: "#d97706",
    background: "#fffbeb",
    label: "Transcript",
  },
  {
    title: "Groq API",
    description: "Generates a concise summary",
    color: "#d97706",
    background: "#fffbeb",
    label: "Summary",
  },
  {
    title: "Neon PostgreSQL",
    description: "Persists audio reference, transcript and summary",
    color: "#15803d",
    background: "#f0fdf4",
    label: "Persistence Complete",
  },
  {
    title: "FastAPI Response",
    description: "Returns processed data as JSON",
    color: "#7c3aed",
    background: "#f5f3ff",
    label: "HTTP Response",
  },
  {
    title: "Results UI",
    description: "Displays transcript and summary to the user",
    color: "#2563eb",
    background: "#eff6ff",
    label: "",
  },
];

const improvements = [
  {
    title: "Asynchronous Processing",
    description:
      "Use Redis with Celery or AWS SQS to process audio in background jobs. Return a job ID immediately after accepting the upload.",
  },
  {
    title: "Audio Chunking",
    description:
      "Split large audio files into smaller chunks to respect API limits and enable parallel transcription where supported.",
  },
];

const requestStages = [
  ["Incoming Request", "Audio upload"],
  ["Processing", "Storage, transcription and summary"],
  ["Database", "Persist results"],
  ["Response", "Return JSON"],
];

export default function ArchitecturePage() {
  return (
    <main
      style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "40px 20px",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
        background: "#ffffff",
      }}
    >
      {/* Header */}
      <header
        style={{
          textAlign: "center",
          marginBottom: "55px",
        }}
      >
        <h1
          style={{
            fontSize: "36px",
            marginBottom: "15px",
          }}
        >
          System Architecture
        </h1>

        <p
          style={{
            color: "#667085",
            fontSize: "16px",
            lineHeight: 1.7,
          }}
        >
          A deep dive into the system design, data flow, and
          infrastructure powering the audio transcription
          and summarization pipeline.
        </p>
      </header>

      {/* Main Flowchart */}
      <section style={{ marginBottom: "70px" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "26px",
          }}
        >
          System Flow: Upload to Transcript
        </h2>

        <p
          style={{
            textAlign: "center",
            color: "#667085",
            marginBottom: "40px",
            lineHeight: 1.6,
          }}
        >
          A sequential view of the frontend, backend,
          external services, and database interactions.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {steps.map((step, index) => (
            <div
              key={step.title}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
              }}
            >
              <div
                style={{
                  width: "min(340px, 90%)",
                  padding: "20px",
                  textAlign: "center",
                  border: `2px solid ${step.color}`,
                  borderRadius: "8px",
                  background: step.background,
                  boxSizing: "border-box",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.05)",
                }}
              >
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: "18px",
                    color: "#1f2937",
                  }}
                >
                  {step.title}
                </h3>

                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: 1.5,
                    color: "#475467",
                  }}
                >
                  {step.description}
                </p>
              </div>

              {index !== steps.length - 1 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: "75px",
                  }}
                >
                  <div
                    style={{
                      width: "2px",
                      height: "25px",
                      background: "#98a2b3",
                    }}
                  />

                  <span
                    style={{
                      fontSize: "18px",
                      color: "#667085",
                      lineHeight: "16px",
                    }}
                  >
                    ▼
                  </span>

                  <span
                    style={{
                      fontSize: "12px",
                      color: "#667085",
                      marginTop: "7px",
                      textAlign: "center",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Request Processing Model */}
      <section style={{ marginBottom: "70px" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "26px",
          }}
        >
          Request Processing Model
        </h2>

        <p
          style={{
            textAlign: "center",
            color: "#667085",
            lineHeight: 1.6,
          }}
        >
          The current architecture follows a synchronous
          request-response lifecycle.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
            gap: "12px",
            margin: "35px 0",
          }}
        >
          {requestStages.map((item, index) => (
            <div
              key={item[0]}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  border: "1px solid #94a3b8",
                  borderRadius: "6px",
                  background: "#f8fafc",
                  padding: "18px 12px",
                  width: "155px",
                  minHeight: "90px",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: "8px",
                }}
              >
                <strong style={{ fontSize: "14px" }}>
                  {item[0]}
                </strong>

                <span
                  style={{
                    fontSize: "12px",
                    color: "#667085",
                  }}
                >
                  {item[1]}
                </span>
              </div>

              {index !== requestStages.length - 1 && (
                <span
                  style={{
                    fontSize: "22px",
                    color: "#64748b",
                  }}
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "20px",
            borderLeft: "4px solid #d97706",
            background: "#fffbeb",
            borderRadius: "4px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            Potential Bottleneck
          </h3>

          <p
            style={{
              lineHeight: 1.7,
              marginBottom: 0,
            }}
          >
            Long audio files increase transcription and
            summarization time. Since the HTTP request remains
            open during processing, the application may
            encounter request timeouts.
          </p>
        </div>
      </section>

      {/* Future Improvements */}
      <section style={{ marginBottom: "70px" }}>
        <h2
          style={{
            textAlign: "center",
            fontSize: "26px",
          }}
        >
          Future Improvements
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(230px, 1fr))",
            gap: "20px",
            marginTop: "35px",
          }}
        >
          {improvements.map((item) => (
            <article
              key={item.title}
              style={{
                border: "1px solid #d0d5dd",
                borderRadius: "8px",
                padding: "22px",
                background: "#ffffff",
              }}
            >
              <h3
                style={{
                  fontSize: "17px",
                  marginTop: 0,
                }}
              >
                {item.title}
              </h3>

              <p
                style={{
                  fontSize: "14px",
                  lineHeight: 1.7,
                  color: "#667085",
                  marginBottom: 0,
                }}
              >
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* GitHub */}
      <footer
        style={{
          borderTop: "1px solid #e4e7ec",
          paddingTop: "35px",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "26px" }}>
          Source Code
        </h2>

        <p
          style={{
            color: "#667085",
            lineHeight: 1.6,
          }}
        >
          Explore the Next.js frontend, FastAPI backend,
          and API integrations in the project repository.
        </p>

        <a
          href="https://github.com/shuklashikhar007/gnani-task"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "12px 22px",
            borderRadius: "6px",
            background: "#202938",
            color: "#ffffff",
            textDecoration: "none",
            marginTop: "12px",
          }}
        >
          View Repository on GitHub ↗
        </a>
      </footer>
    </main>
  );
}
