import React from 'react'

const Footer: React.FC = () => {
  const year = new Date().toISOString().split("-")[0];

  return (
      <div id="footer">
        <img src={"/aws-logo-white.png"} alt={"logo"} height={15}/>
        <a
            target="_blank"
            href="https://aws.amazon.com/"
            className="flex flex-column"
            rel="noreferrer"
        >
        </a>
        <span className="flex"/>
        <div className="font-size-10 copyright">
          Copyright © {year} Amazon Web Services, Inc. or its affiliates. All rights
          reserved.
        </div>
      </div>
  )
}

export default Footer