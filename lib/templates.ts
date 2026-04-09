export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  code: string;
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "hello",
    label: "Hello",
    description: "A tiny warm-up script.",
    code: `print("Hello from the browser!")\nprint("Try editing this code, then press Run.")\n`,
  },
  {
    id: "quiz",
    label: "Quiz",
    description: "A simple input-driven quiz game.",
    code: `print("Welcome to the quiz!")\nname = input("What's your name? ")\nscore = 0\n\nanswer = input("What planet do we live on? ")\nif answer.strip().lower() == "earth":\n    score += 1\n    print("Correct!")\nelse:\n    print("Not quite. The answer is Earth.")\n\nprint(f"{name}, your score is {score}/1")\n`,
  },
  {
    id: "rps",
    label: "Rock Paper Scissors",
    description: "A tiny game with random choice.",
    code: `import random\n\nchoices = ["rock", "paper", "scissors"]\ncomputer = random.choice(choices)\nplayer = input("Choose rock, paper, or scissors: ").strip().lower()\n\nprint(f"Computer chose {computer}.")\n\nif player not in choices:\n    print("That is not a valid choice.")\nelif player == computer:\n    print("It's a tie!")\nelif (\n    (player == "rock" and computer == "scissors")\n    or (player == "paper" and computer == "rock")\n    or (player == "scissors" and computer == "paper")\n):\n    print("You win!")\nelse:\n    print("You lose!")\n`,
  },
];

export const DEFAULT_TEMPLATE = STARTER_TEMPLATES[1];
