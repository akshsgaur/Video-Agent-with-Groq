"use client";
import React, { use, useEffect, useState } from "react";
import AvatarInteraction from "@/app/AvatarInteraction";
import DottedFace from "@/app/components/DottedFace";
import SimliHeaderLogo from "@/app/components/Logo";
import Navbar from "@/app/components/Navbar";
import Image from "next/image";
import GitHubLogo from "@/media/github-mark-white.svg";

// Update the Avatar interface to include an image URL
interface Avatar {
  name: string;
  simli_faceid: string;
  cartesia_model: string;
  cartesia_voice: string;
  deepgram_language: string;
  initialPrompt: string;
}

// Updated JSON structure for avatar data with image URLs
const avatar: Avatar = {
  name: "Tesla",
  simli_faceid: "45687133-5125-4070-b9ec-f5ffbeb6de0b",
  cartesia_model: "nova-2-conversationalai",
  cartesia_voice: "aura-zeus-en",
  deepgram_language: "en",
  initialPrompt:
    "You are a relationship expert who is helping me with my relationship with my girlfriend. Her name is Groq.",
};

const Demo: React.FC = () => {
  const [error, setError] = useState("");
  const [showDottedFace, setShowDottedFace] = useState(true);

  const onStart = () => {
    console.log("Setting setshowDottedface to false...");
    setShowDottedFace(false);
  };

  return (
    <div className="bg-black min-h-screen flex flex-col items-center font-abc-repro font-normal text-sm text-white p-8">
      {/* <SimliHeaderLogo /> */}
      {/* <Navbar /> */}
      <div className="absolute top-[32px] right-[32px]">
        {/*<text
          onClick={() => {
            window.open("https://github.com/simliai/create-simli-app-groq-deepgram");
          }}
          className="font-bold cursor-pointer mb-8 text-xl leading-8"
        >
          <Image className="w-[20px] inline mr-2" src={GitHubLogo} alt="" />
          create-simli-app (Groq + Deepgram)
        </text>*/}
      </div>
      <div className="flex flex-col items-center gap-6 bg-effect15White p-6 pb-[40px] rounded-xl w-full">
        <div>
          {/* {showDottedFace && <DottedFace />} */}
          <AvatarInteraction
            simli_faceid={avatar.simli_faceid}
            deepgram_model={avatar.cartesia_model}
            deepgram_voice={avatar.cartesia_voice}
            deepgram_language={avatar.deepgram_language}
            initialPrompt={avatar.initialPrompt}
            onStart={onStart}
            showDottedFace={showDottedFace}
          />
        </div>
      </div>

      {/* <div className="max-w-[350px] font-thin flex flex-col items-center ">
        <span className="font-bold mb-[8px] leading-5 ">
          {" "}
          Create Simli App is a starter repo for creating an interactive app
          with Simli.{" "}
        </span>
        <ul className="list-decimal list-inside max-w-[350px] ml-[6px] mt-2">
          <li className="mb-1">Fill in your API keys in the .env file.</li>
          <li className="mb-1">
            Test out the interaction and have a conversation with our default
            avatar.
          </li>
          <li className="mb-1">
            You can replace the avatar's face and voice and initial prompt with
            your own. Do this by editing <code>app/page.tsx</code>.
          </li>
        </ul>
        <span className=" mt-[16px]">
          You can now deploy this app to Vercel, or incorporate it as part of
          your existing project.
        </span>
      </div> */}
      {error && (
        <p className="mt-6 text-red-500 bg-red-100 border border-red-400 rounded p-3">
          {error}
        </p>
      )}
    </div>
  );
};

export default Demo;
