/** Small Tako mark used by the account affordances. */
export function TakoLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      data-testid="tako-logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="8" fill="#F26D5B" />
      <path
        d="M6.75 11.25C6.75 8.35 9.17 6 12 6s5.25 2.35 5.25 5.25v2.1c0 .58-.47 1.05-1.05 1.05h-.3v2.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-1.1h-1.32v1.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-1.1h-1.32v1.1c0 .62-.5 1.12-1.12 1.12-.62 0-1.12-.5-1.12-1.12v-2.1h-.3c-.58 0-1.05-.47-1.05-1.05v-2.1Z"
        fill="white"
      />
      <circle cx="10" cy="11" r=".9" fill="#F26D5B" />
      <circle cx="14" cy="11" r=".9" fill="#F26D5B" />
    </svg>
  )
}
