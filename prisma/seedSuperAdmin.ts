import bcrypt from 'bcrypt';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/lib/prisma';
import { Role } from '../src/generated/prisma/enums';

function getCliOption(name: string, short?: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` || (short && args[i] === `-${short}`)) {
      return args[i + 1];
    }
    if (args[i].startsWith(`--${name}=`)) {
      return args[i].slice(name.length + 3);
    }
  }
  return undefined;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const promptText = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    const answer = await rl.question(promptText);
    return answer.trim() || defaultValue || '';
  } finally {
    rl.close();
  }
}

async function main() {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

  let email = getCliOption('email', 'e') || positionalArgs[0];
  let password = getCliOption('password', 'p') || positionalArgs[1];
  let name = getCliOption('name', 'n') || positionalArgs[2];

  // If running interactively in terminal and values were not passed, prompt interactively
  if (process.stdin.isTTY && (!email || !password || !name)) {
    console.log('\n--- Create / Update Super Admin ---');
    if (!email) {
      email = await prompt('Enter Email', 'superadmin@esdo.in');
    }
    if (!password) {
      password = await prompt('Enter Password', 'Esdo@3578');
    }
    if (!name) {
      name = await prompt('Enter Name', 'Super Admin');
    }
  } else {
    email = email || 'superadmin@esdo.in';
    password = password || 'Esdo@3578';
    name = name || 'Super Admin';
  }

  if (!email || !password) {
    console.error('Email and password are required.');
    process.exit(1);
  }

  console.log(`\nSetting up Super Admin for: ${email}`);

  const hashedPassword = await bcrypt.hash(password, 10);

  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        password: hashedPassword,
        name,
      },
    });

    const hasSuperAdminRole = existingUser.roles.some(
      (r) => r.role === Role.SUPER_ADMIN
    );

    if (!hasSuperAdminRole) {
      await prisma.userRole.create({
        data: {
          userId: existingUser.id,
          role: Role.SUPER_ADMIN,
        },
      });
      console.log(`Added SUPER_ADMIN role to existing user (${email}).`);
    } else {
      console.log(`SUPER_ADMIN role already assigned to user (${email}).`);
    }

    console.log(`Password & name updated successfully for: ${email}`);
  } else {
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        saloonId: null,
        roles: {
          create: {
            role: Role.SUPER_ADMIN,
          },
        },
      },
      include: {
        roles: true,
      },
    });

    console.log(`✅ Super Admin created successfully!`);
    console.log(`ID: ${newUser.id}`);
    console.log(`Email: ${newUser.email}`);
    console.log(`Roles: ${newUser.roles.map((r) => r.role).join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error('Failed to create Super Admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
